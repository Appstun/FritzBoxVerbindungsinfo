import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { join } from "node:path";
import { FritzInfoManager } from "./fritzInfoManager";
import { OutageLogger } from "./outageLogger";
import { ConfigManager } from "./configManager";

const webRoot = join(import.meta.dir, "../web");

export namespace Webserver {
  const hono = new Hono();
  const port = ConfigManager.getWebserverPort();

  export function init() {
    createRoutes();
    Bun.serve({
      port,
      fetch: hono.fetch,
    });

    console.log(`Webserver running on http://0.0.0.0:${port}`);
  }

  export function createRoutes() {
    hono.get("/api/health", (c) => {
      return c.text("Ok, but hungry");
    });
    hono.get("/api/fritzbox/connection", (c) => {
      return c.json(FritzInfoManager.getData().connectionInfo ?? {});
    });
    hono.get("/api/fritzbox/log", (c) => {
      return c.json(FritzInfoManager.redactLogEvents(FritzInfoManager.getData().logEvents ?? []));
    });
    hono.get("/api/outage", (c) => {
      const period = c.req.query("period") ?? "24h";
      return c.json(OutageLogger.getAggregated(period));
    });
    hono.use("/*", serveStatic({ root: webRoot }));
  }
}
