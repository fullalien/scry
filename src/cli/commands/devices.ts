import type { Command } from "commander";
import { listAdbDevices } from "../../core/adb/adb-client.js";

export function registerDevicesCommand(program: Command) {
  program
    .command("devices")
    .description("List adb devices")
    .action(async () => {
      const devices = await listAdbDevices();

      if (devices.length === 0) {
        console.log("No adb devices found.");
        return;
      }

      for (const device of devices) {
        console.log(`${device.id}\t${device.state}`);
      }
    });
}
