interface LogEvent {
  id: number;
  group: string;
  date: Date;
  msg: string;
}

interface RawLogEvent {
  id: number;
  group: string;
  date: string;
  msg: string;
}

type ConnectionState = "interrupted" | "connected" | "connecting" | string;

interface ConnectionInfo {
  state: ConnectionState;
  downstream: number | undefined;
  upstream: number | undefined;
}

// ── DOM refs ────────────────────────────────────────────────────────────────

const elOutageTimeline = document.getElementById("outage-timeline")!;
const elOutageUptime = document.getElementById("outage-uptime")!;
const elOutageIncidents = document.getElementById("outage-incidents")!;
const elOutageLabelStart = document.getElementById("outage-label-start")!;
const elOutageTooltip = document.getElementById("outage-tooltip")!;
const elOutagePeriodBtns = document.querySelectorAll<HTMLButtonElement>(".outage-period-btn");

const elStatusDot = document.getElementById("status-dot")!;
const elStatusLabel = document.getElementById("status-label")!;
const elDownstream = document.getElementById("downstream")!;
const elDownstreamMb = document.getElementById("downstream-mb")!;
const elUpstream = document.getElementById("upstream")!;
const elUpstreamMb = document.getElementById("upstream-mb")!;
const elCardConnection = document.getElementById("card-connection")!;
const elLogBody = document.getElementById("log-body")!;
const elLastUpdated = document.getElementById("last-updated")!;
const elServerOffline = document.getElementById("server-offline")!;

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatSpeedParts(kbits: number | undefined): { num: string; unit: string } | null {
  if (kbits === undefined) return null;
  if (kbits >= 1000) return { num: (kbits / 1000).toFixed(1), unit: "Mbit/s" };
  return { num: String(kbits), unit: "kbit/s" };
}

function renderSpeedValue(el: HTMLElement, kbits: number | undefined) {
  const parts = formatSpeedParts(kbits);
  if (!parts) {
    el.textContent = "–";
    return;
  }

  const { num, unit } = parts;
  const numEl = document.createElement("span");
  numEl.className = "monitor-speed-number";
  numEl.textContent = num;

  const unitEl = document.createElement("span");
  unitEl.className = "monitor-speed-unit";
  unitEl.textContent = ` ${unit}`;

  el.replaceChildren(numEl, unitEl);
}

function formatSpeedMb(kbits: number | undefined): string {
  if (kbits === undefined) return "";
  return "nutzbar (" + (kbits / 8000).toFixed(1) + " MB/s)";
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatOutageIncidents(stats: OutageData["stats"]): string {
  const downtime = stats.connecting + stats.interrupted;
  if (downtime === 0) return "Keine Ausfälle";
  if (stats.interrupted > 0 && stats.connecting === 0) {
    return stats.interrupted === 1 ? "1 Min. Ausfall" : `${stats.interrupted} Min. Ausfall`;
  }
  if (stats.connecting > 0 && stats.interrupted === 0) {
    return stats.connecting === 1 ? "1 Min. instabil" : `${stats.connecting} Min. instabil`;
  }
  return downtime === 1 ? "1 Min. Störung" : `${downtime} Min. Störung`;
}

const STATE_LABELS: Record<string, string> = {
  connected: "Verbunden",
  connecting: "Verbindet…",
  interrupted: "Unterbrochen",
};

// ── Outage types ──────────────────────────────────────────────────────────────

type OutageBucketState = "connected" | "connecting" | "interrupted" | "nodata";

interface OutageBucket {
  t: number;
  state: OutageBucketState;
  connected: number;
  connecting: number;
  interrupted: number;
  total: number;
}

interface OutageData {
  period: string;
  bucketMs: number;
  buckets: OutageBucket[];
  stats: { connected: number; connecting: number; interrupted: number; total: number };
  uptimePct: number;
}

const OUTAGE_STATE_LABELS: Record<OutageBucketState, string> = {
  connected: "Verbunden",
  connecting: "Verbindet",
  interrupted: "Unterbrochen",
  nodata: "Keine Daten",
};

// ── State ────────────────────────────────────────────────────────────────────

let knownLogIds = new Set<number>();
let cachedConnection: ConnectionInfo | null = null;
let cachedLog: LogEvent[] | null = null;
let cachedOutage: OutageData | null = null;
let outagePeriod = "24h";
let lastSuccessAt: Date | null = null;

// ── Fetch + render ────────────────────────────────────────────────────────────

async function fetchConnection(): Promise<ConnectionInfo | null> {
  try {
    const res = await fetch("/api/fritzbox/connection");
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function fetchLog(): Promise<LogEvent[] | null> {
  try {
    const res = await fetch("/api/fritzbox/log");
    if (!res.ok) return null;
    const raw: RawLogEvent[] = await res.json();
    return raw.map((e) => ({ ...e, date: new Date(e.date) }));
  } catch {
    return null;
  }
}

async function fetchOutage(): Promise<OutageData | null> {
  try {
    const res = await fetch(`/api/outage?period=${outagePeriod}`);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function fetchHealth(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 2000);
    const res = await fetch("/api/health", { signal: controller.signal });
    clearTimeout(id);
    return res.ok;
  } catch {
    return false;
  }
}

function formatBucketLabel(t: number, bucketMs: number): string {
  const d = new Date(t);
  if (bucketMs <= 60_000) {
    return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  }
  if (bucketMs < 24 * 60 * 60_000) {
    return (
      d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" }) +
      " " +
      d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
    );
  }
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function showOutageTooltip(content: string, clientX: number, clientY: number) {
  elOutageTooltip.hidden = false;
  elOutageTooltip.textContent = content;
  const rect = elOutageTooltip.getBoundingClientRect();
  let left = clientX - rect.width / 2;
  let top = clientY - rect.height - 12;
  if (left < 8) left = 8;
  if (left + rect.width > window.innerWidth - 8) left = window.innerWidth - rect.width - 8;
  if (top < 8) top = clientY + 18;
  elOutageTooltip.style.left = `${left}px`;
  elOutageTooltip.style.top = `${top}px`;
}

function renderOutage(data: OutageData | null) {
  if (!data) return;

  const pct = data.uptimePct;
  elOutageUptime.textContent = `${pct.toFixed(2)} % Uptime`;
  elOutageUptime.className =
    "outage-uptime " + (pct >= 99 ? "outage-uptime--good" : pct >= 95 ? "outage-uptime--warn" : "outage-uptime--bad");

  elOutageIncidents.textContent = formatOutageIncidents(data.stats);

  if (data.buckets.length > 0) {
    elOutageLabelStart.textContent = formatBucketLabel(data.buckets[0]!.t, data.bucketMs);
  }

  const bars = data.buckets.map((bucket) => {
    const bar = document.createElement("div");
    bar.className = `outage-bar outage-bar--${bucket.state}`;

    const timeLabel = formatBucketLabel(bucket.t, data.bucketMs);
    const stateLabel = OUTAGE_STATE_LABELS[bucket.state];
    let tooltip = `${timeLabel}\n${stateLabel}`;
    if (bucket.total > 0) {
      tooltip += `\n${bucket.connected} verbunden  ${bucket.connecting} verbindet  ${bucket.interrupted} unterbrochen`;
    }

    bar.addEventListener("mousemove", (e) => showOutageTooltip(tooltip, e.clientX, e.clientY));
    bar.addEventListener("mouseleave", () => { elOutageTooltip.hidden = true; });

    return bar;
  });

  elOutageTimeline.replaceChildren(...bars);
}

// ── Period button handlers ────────────────────────────────────────────────────

elOutagePeriodBtns.forEach((btn) => {
  btn.addEventListener("click", async () => {
    outagePeriod = btn.dataset["period"] ?? "24h";
    elOutagePeriodBtns.forEach((b) => b.classList.toggle("active", b === btn));
    const data = await fetchOutage();
    if (data !== null) cachedOutage = data;
    renderOutage(cachedOutage);
  });
});

function renderConnection(info: ConnectionInfo | null) {
  if (!info || !info.state) {
    elStatusDot.className = "monitor-status-pill";
    elCardConnection.className = "";
    elStatusLabel.textContent = "Keine Daten";
    elDownstream.textContent = "–";
    elDownstreamMb.textContent = "";
    elUpstream.textContent = "–";
    elUpstreamMb.textContent = "";
    return;
  }

  elStatusDot.className = `monitor-status-pill ${info.state}`;
  elCardConnection.className = `monitor-state-${info.state}`;
  elStatusLabel.textContent = STATE_LABELS[info.state] ?? info.state;
  renderSpeedValue(elDownstream, info.downstream);
  elDownstreamMb.textContent = formatSpeedMb(info.downstream);
  renderSpeedValue(elUpstream, info.upstream);
  elUpstreamMb.textContent = formatSpeedMb(info.upstream);
}

function renderLog(events: LogEvent[] | null) {
  if (!events || events.length === 0) {
    elLogBody.innerHTML = `<tr><td colspan="2" class="placeholder">Keine Einträge</td></tr>`;
    return;
  }

  const isFirstLoad = knownLogIds.size === 0;
  const newIds = new Set(events.map((e) => e.id));

  const rows = events.map((event) => {
    const isNew = !isFirstLoad && !knownLogIds.has(event.id);
    const tr = document.createElement("tr");
    if (isNew) tr.className = "log-new";

    const tdTime = document.createElement("td");
    tdTime.textContent = formatTime(event.date);

    const tdMsg = document.createElement("td");
    tdMsg.textContent = event.msg;

    tr.append(tdTime, tdMsg);
    return tr;
  });

  elLogBody.replaceChildren(...rows);
  knownLogIds = newIds;
}

function renderServerStatus(online: boolean) {
  elServerOffline.hidden = online;

  if (online) {
    const now = new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    elLastUpdated.textContent = `Aktualisiert: ${now}`;
    return;
  }

  if (lastSuccessAt) {
    const time = lastSuccessAt.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    elLastUpdated.textContent = `Zuletzt: ${time}`;
  } else {
    elLastUpdated.textContent = "Offline";
  }
}

async function update() {
  const online = await fetchHealth();

  if (online) {
    const [connection, log, outage] = await Promise.all([fetchConnection(), fetchLog(), fetchOutage()]);
    if (connection !== null) cachedConnection = connection;
    if (log !== null) cachedLog = log;
    if (outage !== null) cachedOutage = outage;
    if (connection !== null || log !== null) lastSuccessAt = new Date();
  }

  renderConnection(cachedConnection);
  if (cachedLog !== null) renderLog(cachedLog);
  renderOutage(cachedOutage);
  renderServerStatus(online);
}

// ── Init ─────────────────────────────────────────────────────────────────────

update();
setInterval(update, 5_000);
