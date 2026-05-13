import { execFile } from "node:child_process";
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
