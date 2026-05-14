import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type AdbDevice = {
  id: string;
  state: string;
};

export async function listAdbDevices(): Promise<AdbDevice[]> {
  const { stdout } = await execFileAsync("adb", ["devices"]);

  return stdout
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [id, state] = line.split(/\s+/);
      return { id, state };
    });
}

export async function adbPush(
  deviceId: string,
  local: string,
  remote: string,
): Promise<void> {
  await execFileAsync("adb", ["-s", deviceId, "push", local, remote]);
}

export async function adbForward(
  deviceId: string,
  localPort: number,
  remoteAbstract: string,
): Promise<void> {
  await execFileAsync("adb", [
    "-s",
    deviceId,
    "forward",
    `tcp:${localPort}`,
    `localabstract:${remoteAbstract}`,
  ]);
}

export async function adbForwardRemove(
  deviceId: string,
  localPort: number,
): Promise<void> {
  await execFileAsync("adb", [
    "-s",
    deviceId,
    "forward",
    "--remove",
    `tcp:${localPort}`,
  ]).catch(() => {});
}

/** Run `adb shell <cmd>` and return stdout (rejects on non-zero exit). */
export async function adbShell(
  deviceId: string,
  cmd: string,
): Promise<string> {
  const { stdout } = await execFileAsync("adb", ["-s", deviceId, "shell", cmd]);
  return stdout;
}


export function adbShellSpawn(
  deviceId: string,
  cmdArgs: string[],
): ReturnType<typeof spawn> {
  return spawn("adb", ["-s", deviceId, "shell", ...cmdArgs], {
    stdio: ["ignore", "pipe", "pipe"],
  });
}
