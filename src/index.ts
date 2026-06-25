import { FritzInfoManager } from "./fritzInfoManager";
import { OutageLogger } from "./outageLogger";
import { Webserver } from "./webserver";

Webserver.init();

void (async () => {
  await FritzInfoManager.init();
  OutageLogger.init();
})();
