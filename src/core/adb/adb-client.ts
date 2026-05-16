import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type AdbDevice = {
  id: string;
  state: string;
  model?: string;
  brand?: string;
  manufacturer?: string;
  device?: string;
  androidVersion?: string;
  apiLevel?: string;
  screenRes?: string;
  screenDensity?: string;
};

const DEVICE_PROPS = [
  'ro.product.model',
  'ro.product.brand',
  'ro.product.manufacturer',
  'ro.product.device',
  'ro.build.version.release',
  'ro.build.version.sdk',
] as const;

type DeviceDetails = {
  model?: string;
  brand?: string;
  manufacturer?: string;
  device?: string;
  androidVersion?: string;
  apiLevel?: string;
  screenRes?: string;
  screenDensity?: string;
};

/** In-memory cache: deviceId → details. Cleared only when the device disappears. */
const deviceDetailsCache = new Map<string, DeviceDetails>();

async function getDeviceDetails(deviceId: string): Promise<DeviceDetails> {
  try {
    // Query all props + wm size/density in one shell invocation
    const propsQuery = DEVICE_PROPS.map(p => `getprop ${p}`).join('; ');
    const stdout = await adbShell(
      deviceId,
      `${propsQuery}; echo "---SIZE---"; wm size; echo "---DENSITY---"; wm density`,
    );

    // Strip \r to handle Android's \r\n line endings
    const clean = (s: string) => s.replace(/\r/g, '').trim();

    const [propsRaw, sizeRaw, densityRaw] = stdout.split(/---SIZE---|---DENSITY---/);
    const propLines = clean(propsRaw ?? '').split('\n');

    const [model, brand, manufacturer, device, androidVersion, apiLevel] = propLines;

    // wm size  → "Physical size: 1080x2400"
    const screenRes = clean(sizeRaw ?? '')
      .replace(/Physical size:\s*/i, '')
      .replace(/Override size:\s*\S+/i, '')
      .trim() || undefined;

    // wm density → "Physical density: 440"
    const screenDensity = clean(densityRaw ?? '')
      .replace(/Physical density:\s*/i, '')
      .replace(/Override density:\s*\S+/i, '')
      .trim() || undefined;

    return {
      model: model || undefined,
      brand: brand || undefined,
      manufacturer: manufacturer || undefined,
      device: device || undefined,
      androidVersion: androidVersion || undefined,
      apiLevel: apiLevel || undefined,
      screenRes,
      screenDensity,
    };
  } catch {
    return {};
  }
}

export async function listAdbDevices(): Promise<AdbDevice[]> {
  const { stdout } = await execFileAsync('adb', ['devices']);

  const basicDevices = stdout
    .split('\n')
    .slice(1)
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => {
      const [id, state] = line.split(/\s+/);
      return { id: id ?? '', state: state ?? '' };
    });

  // Evict cache entries for devices no longer present
  const currentIds = new Set(basicDevices.map(d => d.id));
  for (const cachedId of deviceDetailsCache.keys()) {
    if (!currentIds.has(cachedId)) deviceDetailsCache.delete(cachedId);
  }

  // Enrich online devices with details in parallel (cache-first)
  const enriched = await Promise.all(
    basicDevices.map(async d => {
      if (d.state !== 'device') return d as AdbDevice;
      const cached = deviceDetailsCache.get(d.id);
      if (cached) return { ...d, ...cached };
      const details = await getDeviceDetails(d.id);
      deviceDetailsCache.set(d.id, details);
      return { ...d, ...details };
    })
  );

  return enriched;
}

export async function adbPush(
  deviceId: string,
  local: string,
  remote: string
): Promise<void> {
  await execFileAsync('adb', ['-s', deviceId, 'push', local, remote]);
}

export async function adbForward(
  deviceId: string,
  localPort: number,
  remoteAbstract: string
): Promise<void> {
  await execFileAsync('adb', [
    '-s',
    deviceId,
    'forward',
    `tcp:${localPort}`,
    `localabstract:${remoteAbstract}`,
  ]);
}

export async function adbForwardRemove(
  deviceId: string,
  localPort: number
): Promise<void> {
  await execFileAsync('adb', [
    '-s',
    deviceId,
    'forward',
    '--remove',
    `tcp:${localPort}`,
  ]).catch(() => {});
}

/** Run `adb shell <cmd>` and return stdout (rejects on non-zero exit). */
export async function adbShell(deviceId: string, cmd: string): Promise<string> {
  const { stdout } = await execFileAsync('adb', ['-s', deviceId, 'shell', cmd]);
  return stdout;
}

export function adbShellSpawn(
  deviceId: string,
  cmdArgs: string[]
): ReturnType<typeof spawn> {
  return spawn('adb', ['-s', deviceId, 'shell', ...cmdArgs], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
