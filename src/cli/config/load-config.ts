import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { appConfigSchema, type AppConfig } from './schema.js';

const DEFAULT_CONFIG_PATH = path.join(
  homedir(),
  '.config',
  'scrcpy-web',
  'config.json'
);

function expandHome(filePath: string): string {
  if (!filePath.startsWith('~/')) {
    return filePath;
  }
  return path.join(homedir(), filePath.slice(2));
}

export function loadConfig(): AppConfig {
  const configPath = process.env['SCRCPY_WEB_CONFIG_FILE']
    ? path.resolve(process.env['SCRCPY_WEB_CONFIG_FILE'])
    : DEFAULT_CONFIG_PATH;

  let fileConfig: Record<string, unknown> = {};

  if (existsSync(configPath)) {
    try {
      fileConfig = JSON.parse(readFileSync(configPath, 'utf8')) as Record<
        string,
        unknown
      >;
    } catch {
      fileConfig = {};
    }
  }

  const merged = appConfigSchema.parse(fileConfig);

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

  if (process.env['SCRCPY_WEB_SCRCPY_PATH']) {
    merged.scrcpy.path = process.env['SCRCPY_WEB_SCRCPY_PATH'];
  }

  merged.logs.file = expandHome(merged.logs.file);
  return merged;
}
