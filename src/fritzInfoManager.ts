import { FritzBox } from "@lukesthl/fritzbox";
import { ConfigManager } from "./configManager";

//! https://github.com/lukesthl/fritzbox
const DEVICE_INFO_SERVICE = "urn:DeviceInfo-com:serviceId:DeviceInfo1";

export type DeviceLogFilter = "sys" | "net" | "fon" | "wlan" | "usb";
export interface LogEvent {
  id: number;
  group: string;
  date: Date;
  msg: string;
}

export type ConnectionState = "interrupted" | "connected" | "connecting" | string;
export interface ConnectionInfo {
  state: ConnectionState;
  downstream: number | undefined;
  upstream: number | undefined;
}

export namespace FritzInfoManager {
  let fritzbox: FritzBox | null = null;
  let updateInterval: NodeJS.Timeout | null = null;

  let cachedData: { connectionInfo?: ConnectionInfo; logEvents?: LogEvent[] } = {};

  export async function init() {
    fritzbox = new FritzBox(ConfigManager.getFritzboxlogin());
    await fritzbox.init();

    await updateData();
    updateInterval = setInterval(updateData, 1000 * 5);
  }

  async function updateData() {
    const [networkStats, log] = await Promise.allSettled([fritzbox?.unofficial.networkMonitor.getNetworkStats(), getFullLog("net")]);

    if (networkStats.status === "fulfilled") {
      const conn = networkStats.value?.data.connections[0]!;
      cachedData.connectionInfo = {
        state: conn.state as ConnectionState,
        downstream: conn.downstream,
        upstream: conn.upstream,
      };
    }

    if (log.status === "fulfilled") {
      cachedData.logEvents = log.value;
    }
  }

  async function getFullLog(filter?: DeviceLogFilter): Promise<LogEvent[]> {
    if (!fritzbox) return [];

    try {
      const { NewDeviceLogPath } = await fritzbox.exec<{ NewDeviceLogPath: string }>({
        serviceId: DEVICE_INFO_SERVICE,
        actionName: "X_AVM-DE_GetDeviceLogPath",
      });

      let path = NewDeviceLogPath;
      if (filter) {
        path += `&filter=${filter}`;
      }

      const fritzboxUrl = fritzbox.url;
      const url = `${fritzboxUrl.protocol}//${fritzboxUrl.hostname}:${fritzboxUrl.port}${path}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Device log fetch failed: ${response.status}`);
      }

      return sortLogEvents(parseDeviceLogXml(await response.text()));
    } catch {
      const legacy = await fritzbox.deviceInfo.getDeviceLog();
      return sortLogEvents(
        legacy.NewDeviceLog.split("\n")
          .filter(Boolean)
          .map((line, index) => {
            const match = line.match(/^(\d{2}\.\d{2}\.\d{2}) (\d{2}:\d{2}:\d{2}) (.*)$/);
            return {
              id: index,
              group: "",
              date: match ? parseEventDate(match[1]!, match[2]!) : new Date(0),
              msg: match?.[3] ?? line,
            };
          }),
      );
    }
  }

  function sortLogEvents(events: LogEvent[]): LogEvent[] {
    return events.sort((a, b) => b.date.getTime() - a.date.getTime() || b.id - a.id);
  }

  function parseEventDate(date: string, time: string): Date {
    const [day, month, year] = date.split(".");
    const [hours, minutes, seconds] = time.split(":");
    return new Date(2000 + Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes), Number(seconds));
  }

  function parseDeviceLogXml(xml: string): LogEvent[] {
    const events: LogEvent[] = [];

    for (const block of xml.match(/<Event>[\s\S]*?<\/Event>/gi) ?? []) {
      const read = (tag: string) => block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1]?.trim() ?? "";
      const dateStr = read("date");
      const timeStr = read("time");

      events.push({
        id: Number(read("id")),
        group: read("group"),
        date: parseEventDate(dateStr, timeStr),
        msg: read("msg"),
      });
    }

    return events;
  }

  function redactMsg(msg: string): string {
    return msg
      .replace(/\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g, "XXX.XXX.XXX.XXX")
      .replace(
        /\b(?:[0-9a-fA-F]{1,4}:)+[0-9a-fA-F]{0,4}(?:::[0-9a-fA-F]{0,4}(?::[0-9a-fA-F]{1,4})*)?(?:\/\d{1,3})?\b/gi,
        "XXXX:XXXX:XXXX:XXXX:XXXX:XXXX:XXXX:XXXX",
      )
      .replace(/LineID:\s*\S+/g, "LineID: XXXX");
  }

  export function redactLogEvents(events: LogEvent[]) {
    return events.map((event) => ({
      id: event.id,
      group: event.group,
      date: event.date,
      msg: redactMsg(event.msg),
    }));
  }

  export function getData() {
    return cachedData;
  }
}
