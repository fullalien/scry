/**
 * Provides the path to the bundled scrcpy-server jar.
 *
 * The jar is stored at src/core/scrcpy/resources/scrcpy-server-v4.0 and
 * copied to dist/core/scrcpy/resources/ by the build script — no network
 * download required.
 */

import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const SERVER_VERSION = "4.0";

/** Path to the bundled scrcpy-server jar (works in both dev/tsx and built/dist). */
export const SERVER_JAR_PATH = path.resolve(
  __dirname,
  "./resources/scrcpy-server-v4.0",
);

/** Returns the path to the bundled scrcpy-server jar. */
export function getServerJarPath(): string {
  return SERVER_JAR_PATH;
}
