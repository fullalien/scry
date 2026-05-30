import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const HOST_DISPLAY_CACHE_TTL_MS = 30_000;
const EMPTY_HOST_DISPLAY_CACHE_TTL_MS = 1_000;

export type HostDisplay = {
  name?: string;
  widthMm: number;
  heightMm: number;
  nativeWidth?: number;
  nativeHeight?: number;
};

let cachedHostDisplays:
  | {
      displays: HostDisplay[];
      expiresAt: number;
    }
  | undefined;

export async function getHostDisplays(): Promise<HostDisplay[]> {
  if (process.platform !== 'darwin') return [];

  if (cachedHostDisplays && Date.now() < cachedHostDisplays.expiresAt) {
    return cachedHostDisplays.displays;
  }

  try {
    const { stdout } = await exec('ioreg', ['-l', '-w0'], {
      maxBuffer: 64 * 1024 * 1024,
    });
    const displays = parseIoregDisplays(stdout);
    cachedHostDisplays = {
      displays,
      expiresAt:
        Date.now() +
        (displays.length > 0
          ? HOST_DISPLAY_CACHE_TTL_MS
          : EMPTY_HOST_DISPLAY_CACHE_TTL_MS),
    };
    return displays;
  } catch {
    return [];
  }
}

function parseIoregDisplays(output: string): HostDisplay[] {
  return dedupeDisplays([
    ...parseDisplayAttributes(output),
    ...parseConnectionMappings(output),
  ]);
}

function parseDisplayAttributes(output: string): HostDisplay[] {
  const displays: HostDisplay[] = [];
  const matches = output.matchAll(/"DisplayAttributes"\s*=\s*(\{[^\n]+\})/g);

  for (const match of matches) {
    const text = match[1] ?? '';
    const display = parseDisplayDictionary(text, {
      nativeWidth: 'NativeFormatHorizontalPixels',
      nativeHeight: 'NativeFormatVerticalPixels',
    });
    if (display) displays.push(display);
  }

  return displays;
}

function parseConnectionMappings(output: string): HostDisplay[] {
  const displays: HostDisplay[] = [];
  const matches = output.matchAll(
    /"ConnectionMapping"\s*=\s*\((\{[^\n]+\})\)/g
  );

  for (const match of matches) {
    const text = match[1] ?? '';
    const display = parseDisplayDictionary(text, {
      nativeWidth: 'MaxW',
      nativeHeight: 'MaxH',
    });
    if (display) displays.push(display);
  }

  return displays;
}

function parseDisplayDictionary(
  text: string,
  fields: { nativeWidth: string; nativeHeight: string }
): HostDisplay | null {
  const widthCm = parseNumberAttribute(text, 'MaxHorizontalImageSize');
  const heightCm = parseNumberAttribute(text, 'MaxVerticalImageSize');

  if (!widthCm || !heightCm) return null;

  return {
    name: parseStringAttribute(text, 'ProductName'),
    widthMm: widthCm * 10,
    heightMm: heightCm * 10,
    nativeWidth: parseNumberAttribute(text, fields.nativeWidth),
    nativeHeight: parseNumberAttribute(text, fields.nativeHeight),
  };
}

function parseNumberAttribute(
  text: string,
  attribute: string
): number | undefined {
  const match = text.match(
    new RegExp(`"${attribute}"\\s*=\\s*(0x[\\da-f]+|\\d+)`, 'i')
  );
  if (!match) return undefined;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return value;
}

function parseStringAttribute(
  text: string,
  attribute: string
): string | undefined {
  const match = text.match(new RegExp(`"${attribute}"\\s*=\\s*"([^"]+)"`));
  return match?.[1];
}

function dedupeDisplays(displays: HostDisplay[]): HostDisplay[] {
  const seen = new Set<string>();
  const deduped: HostDisplay[] = [];

  for (const display of displays) {
    const key = [
      display.name ?? '',
      display.widthMm,
      display.heightMm,
      display.nativeWidth ?? '',
      display.nativeHeight ?? '',
    ].join(':');

    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(display);
  }

  return deduped;
}
