# FritzBox Verbindungsinformationen

Eine lokale Web-App, die den Internetzugang deiner FritzBox live anzeigt: Verbindungsstatus, Up-/Download-Geschwindigkeit, Ereignisprotokoll und eine Verbindungshistorie mit Uptime-Statistik.

## Features

- **Live-Monitor** – Aktueller Status (verbunden, verbindet, unterbrochen) mit Download- und Upload-Geschwindigkeit
- **Ereignisprotokoll** – Internetzugangs-Log der FritzBox, mit automatischer Schwärzung von IP-Adressen und LineIDs
- **Verbindungshistorie** – Zeitstrahl der letzten 1h, 6h, 24h, 7, 30 oder 90 Tage inkl. Uptime-Prozent
- **Persistente Historie** – Ausfälle werden minütlich erfasst und bis zu 90 Tage in `files/outage-history.json` gespeichert

## Voraussetzungen

- [Bun](https://bun.sh) (Runtime)
- Eine erreichbare FritzBox im lokalen Netzwerk
- Ein FritzBox-Benutzer mit Zugriff auf die Weboberfläche (für die TR-064-API)

## Installation

```bash
pnpm i
# oder
npm i
```

## Konfiguration

Kopiere die Vorlage und trage deine Zugangsdaten ein:

```bash
cp files/config.env.template files/config.env
```

| Variable | Beschreibung |
|---|---|
| `FRITZBOX_USERNAME` | Benutzername (in der FritzBox unter *System → FRITZ!Box-Benutzer* anlegen) |
| `FRITZBOX_PASSWORD` | Passwort des Benutzers |
| `FRITZBOX_HOST` | IP-Adresse der FritzBox (Standard: `192.168.179.1`) |
| `WEBSERVER_PORT` | Port des lokalen Webservers (Standard: `80`) |

## Starten

Zuerst das Frontend bauen, dann den Server starten:

```bash
bun run build
bun start
```