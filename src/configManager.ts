import dotenv from "dotenv";

export namespace ConfigManager {
  const config = dotenv.config({ path: "./files/config.env", quiet: true });

  export function getFritzboxlogin() {
    return {
      username: config.parsed?.FRITZBOX_USERNAME,
      password: config.parsed?.FRITZBOX_PASSWORD,
      host: config.parsed?.FRITZBOX_HOST,
    };
  }

  export function getWebserverPort() {
    return config.parsed?.WEBSERVER_PORT ? parseInt(config.parsed.WEBSERVER_PORT) : 5468;
  }
}
