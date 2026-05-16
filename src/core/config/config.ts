import { existsSync, readFileSync } from 'node:fs';
import JSON5 from 'json5';
import { ConfigSchema, type AppConfig } from './schema.js';
import { CONFIG_PATH } from './config.constants.js';

export function loadConfig(): AppConfig {
  let fileConfig: Record<string, unknown> = {};

  if (existsSync(CONFIG_PATH)) {
    try {
      fileConfig = JSON5.parse(readFileSync(CONFIG_PATH, 'utf8')) as Record<
        string,
        unknown
      >;
    } catch {
      fileConfig = {};
    }
  }

  const merged = ConfigSchema.parse(fileConfig);

  if (process.env['SCRCPY_WEB_HOST']) {
    merged.server.host = process.env['SCRCPY_WEB_HOST'];
  }

  if (process.env['SCRCPY_WEB_PORT']) {
    const port = Number(process.env['SCRCPY_WEB_PORT']);
    if (Number.isInteger(port) && port > 0 && port <= 65535) {
      merged.server.port = port;
    }
  }

  if (process.env['SCRCPY_WEB_ADB_PATH']) {
    merged.adb.path = process.env['SCRCPY_WEB_ADB_PATH'];
  }

  return merged;
}
