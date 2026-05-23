# scry

Mirror Android device screens in the browser via a bundled [scrcpy-server](https://github.com/Genymobile/scrcpy) runtime.

`scry` runs a local web server that streams your Android device's screen over WebSocket, rendered on an HTML canvas with touch and keyboard input forwarding.
It depends on the bundled scrcpy-server jar and does not require installing the `scrcpy` desktop app on your machine.

## Features

- **Browser-based screen mirroring** — no desktop client required
- **Multi-device support** — list and open any connected ADB device
- **Touch & keyboard input forwarding** — interact with the device from the browser
- **Background daemon** — start once, access from any browser tab
- **Configurable** — tune video bitrate, resolution cap, FPS, and server address

## Requirements

- [Node.js](https://nodejs.org/) >= 20
- [`adb`](https://developer.android.com/tools/adb) (Android Debug Bridge) in your `PATH`

## Installation

```sh
npm install -g @fullalien/scry
```

## Quick Start

1. Connect an Android device via USB (USB debugging must be enabled).
2. Start the server:

```sh
scry start
```

3. Open [http://127.0.0.1:8080](http://127.0.0.1:8080) in your browser.
4. Click **Open** next to a device to start mirroring.

## CLI

```
scry <command> [options]
```

```sh
# Start server (background daemon by default)
scry start

# Start server in foreground and override bind address/port
scry start --foreground --host 127.0.0.1 --port 8080

# Stop running server
scry stop

# Show server status (PID/address/start time)
scry status

# List connected adb devices
scry devices

# Check environment (adb + port availability)
scry doctor
```

## Configuration

On first run, `scry` uses built-in defaults. To customise behaviour, create `~/.scry/config.json` (JSON5 syntax is supported).

```json5
{
  server: {
    host: "127.0.0.1", // Interface to bind
    port: 8080,        // Port to listen on
  },
  adb: {
    path: "adb",       // Path to the adb binary
  },
  scrcpy: {
    videoBitRate: 4000000,   // Video bit rate in bps (default 4 Mbps)
    maxSize: 0,              // Limit the longest dimension (0 = no limit)
    maxFps: 60,              // Cap frame rate (optional)
  },
}
```

### Environment Variables

| Variable              | Description                              |
| --------------------- | ---------------------------------------- |
| `SCRCPY_WEB_HOST`     | Override `server.host` from config       |
| `SCRCPY_WEB_PORT`     | Override `server.port` from config       |
| `SCRCPY_WEB_ADB_PATH` | Override `adb.path` from config          |

## Development

```sh
# Install dependencies
npm install

# Rebuild backend (TypeScript watch) and frontend bundle (Vite watch)
npm run dev

# In another terminal, start the local CLI/server
npm run start

# Type-check
npm run typecheck

# Build for production
npm run build

# Format code
npm run format
```

### Useful dev commands

```sh
# List devices using the local source
npm run dev:devices

# Run doctor checks using the local source
npm run dev:doctor
```

## License

Apache-2.0
