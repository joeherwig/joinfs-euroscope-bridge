# JoinFS → EuroScope Bridge
![JoinFS-EuroScope-bridge icon](https://raw.githubusercontent.com/joeherwig/joinfs-euroscope-bridge/refs/heads/main/docs/JoinFS-EuroScope-bridge-icon.svg)

Shows live [JoinFS](https://joinfs.net/) traffic in [EuroScope](https://www.euroscope.hu/) as real, interactive aircraft — selectable, tag-clickable, and able to receive text messages — not just symbols drawn on the screen.

It works by connecting to JoinFS's live websocket feed and re-serving that traffic to EuroScope over a local network connection, the same way EuroScope normally receives traffic from an ATC network. Aircraft positions are forwarded as soon as JoinFS reports them (no artificial delay), so the picture stays smooth and current.

## Quick start (end users)

1. Download the latest release zip and extract it. You'll get a `JoinFS-EuroScope-bridge` folder containing:
   - `joinfs-euroscope-bridge.exe`
   - `config.json`
   - this README
2. Open `config.json` in a text editor and fill in your JoinFS websocket details (see [Configuring config.json](#configuring-configjson) below).
3. Double-click `joinfs-euroscope-bridge.exe` to start it. A console window opens and logs its status — leave it running in the background.
4. In EuroScope, open the **Connect dialog** and connect to the bridge (see [Connecting from EuroScope](#connecting-from-euroscope) below).

No Node.js install or command line needed — the `.exe` is fully self-contained.

## Configuring config.json

Start from `config.example.json` if you ever need a clean template — `config.json` is your own editable copy (release zips ship it pre-filled with the example defaults).

| Field | Description |
| --- | --- |
| `joinfsWebSocketUrl` | The `wss://` URL of JoinFS's live traffic feed. Required. |
| `joinfsAuthHeaderName` / `joinfsAuthHeaderValue` | Optional HTTP header sent when connecting to JoinFS, if your feed requires authentication. Leave both blank if not needed. |
| `fsdListenHost` | Address the bridge listens on for EuroScope. Leave as `127.0.0.1` unless you specifically want other machines to connect. |
| `fsdListenPort` | Port the bridge listens on. Defaults to `6809`, which is also EuroScope's default when no port is specified. |
| `stationLogging` | Optional, default `false`. When `true`, the ATC stations EuroScope logs in (callsign, frequency, facility), their ATIS, every raw FSD line and the TeamSpeak webhook payloads are written to the normal `joinfs-euroscope-bridge.log` (`[STATION]` lines). |
| `tsapiUrl` | Optional. If set (e.g. `http://tsapi:8081/atcstation`), the bridge sends `PUT` webhooks to the TeamSpeak API whenever a station (including an ATIS connection) comes online, changes frequency/ATIS text, or goes offline. A station is reported like a COM update: `{"comsupdate":[{"callsign":"EDDS_ATIS","nickname":"Joe","com1":"123.130","text":"<merged ATIS text>","online":true}]}` (`online` is `true`, or `false` when the station disconnects; `text` only for an ATIS). Empty = no webhook. |
| `tsapiAuthHeaderName` / `tsapiAuthHeaderValue` / `tsapiTimeoutMs` | Optional auth header for the webhook and its timeout (default 5000 ms). |
| `updateIntervalMs` | How often JoinFS pushes updates, for reference only — not currently used to throttle anything. |

The bridge always reads `config.json` from the same folder as the `.exe` — edit it and just restart the `.exe`, no rebuild needed.

## Connecting from EuroScope

Open EuroScope's **Connect dialog** and set it up like this:

![EuroScope Connect dialog configured to connect to the bridge](docs/connect-dialog.png)

1. **Select connection mode**: `Direct to VATSIM`
2. **Server**: `localhost` (leave the port blank — it defaults to `6809`, matching the bridge's default)
3. **Callsign / Facility / Rating**: enter your usual controller callsign, facility, and rating as normal
4. **Important — uncheck "Connect to VATSIM"**. This is the one setting that matters most: the bridge identifies itself as a non-VATSIM server, and EuroScope will immediately reject the connection with *"VATSIM server found while non-VATSIM server was requested"* if this box is checked.
5. Click **Connect**.

JoinFS traffic should start appearing on the radar within a few seconds, fully selectable with normal tags and flight plan data.

**Note:** the aircraft shown are live positions only — there's no real pilot behind them, so sending one a text message won't get a reply (that's expected, not a bug).

## Troubleshooting

- The `.exe`'s own console window logs connection status for both sides (JoinFS and EuroScope) and writes the same log to `joinfs-euroscope-bridge.log` next to it.
- EuroScope itself doesn't keep a log file — check the message/chat area at the bottom of its radar screen, or **Settings → System messages...**, for anything it reports about the connection.

## ATC stations and ATIS → TeamSpeak (optional)

Every ATC connection EuroScope opens to the bridge is a *station*: its callsign (e.g. `EDDS_TWR`), the frequency it has tuned, and — for an ATIS connection (`EDDS_ATIS`) — the ATIS text from EuroScope's "ATIS connection setup" dialog. A station is just a COM1 tuned to a frequency, so it is reported in the same shape as a pilot's COM update. With `tsapiUrl` set, the bridge sends:

```
PUT <tsapiUrl>
{"comsupdate":[{"callsign":"EDDS_ATIS","nickname":"Joe","com1":"123.130",
  "text":"STUTTGART INFORMATION B .. RWY 25 ..","online":true}]}
```

- `callsign` = station callsign (later the TeamSpeak channel name), `com1` = its primary frequency (later the channel topic), `text` = the ATIS text merged into one string (later the channel description; only present for an ATIS), `nickname` = the name entered in EuroScope.
- Sent when a station appears, when its frequency or ATIS text changes, again every 5 minutes, and with `"online":false` (and no `text`) when the station disconnects or the bridge shuts down.
- EuroScope only announces the ATIS *letter*; the bridge therefore asks the ATIS connection for its text (`$CQ…:ATIS`) on login, on every new letter and once a minute.
- Without `tsapiUrl` nothing is sent. With `"stationLogging": true` the payloads (and every raw FSD line) are written to the normal log file as `[STATION]` lines, which is also a quick way to see what EuroScope reports.

## For developers

Project layout:

```
src/
  index.js            entry point
  config.js            loads config.json from beside the running exe (or repo root in dev)
  joinfsClient.js       wss:// client for the JoinFS feed
  aircraftStore.js      merges/tracks aircraft state, expires stale ones
  fsdServer.js           TCP server EuroScope connects to
  fsdProtocol.js         packet builders/parsers for the wire format
  stationTracker.js      ATC stations/ATIS from EuroScope -> TSAPI comsupdate payloads
  tsapiClient.js         PUT webhook to the TeamSpeak API (only if tsapiUrl is set)
  logger.js
scripts/
  build-exe.js          bundles + packages a standalone .exe (Node SEA)
  build-release.ps1      full release build: exe + zip for distribution
  render-readme.js      renders README.md to README.html for the release zip
```

Run from source:

```
npm install
npm start
```

Build a standalone `.exe` only (output in `dist/`):

```
npm run build:exe
```

Build a full release zip (output in `release/`):

```
npm run build:release
```

Both build steps bundle `src/` and its npm dependencies into a single file with [esbuild](https://esbuild.github.io/), then package it as a portable `.exe` using Node's built-in [Single Executable Applications](https://nodejs.org/api/single-executable-applications.html) feature — no third-party packager, no installer. 
The release is then placed as zip into the /release folder.

## Contributing

Issues and pull requests are welcome. If you're planning a larger change, please open an issue first to discuss it before investing significant time.

## License

This project is licensed under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) (Attribution-NonCommercial-ShareAlike) — see [LICENSE](LICENSE) for details.
