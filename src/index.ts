import { FritzInfoManager } from "./fritzInfoManager";
import { OutageLogger } from "./outageLogger";
import { Webserver } from "./webserver";

Webserver.init();
FritzInfoManager.init();
OutageLogger.init();
