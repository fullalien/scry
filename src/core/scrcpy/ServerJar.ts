/**
 * Downloads and caches the scrcpy-server.jar on first use.
 * The jar is fetched from the official scrcpy GitHub release and stored in
 * ~/.cache/scrcpy-web/ so subsequent starts are instant.
 */

import { createWriteStream } from "node:fs";
import { access, mkdir, unlink } from "node:fs/promises";
import https from "node:https";
import { homedir } from "node:os";
import { join } from "node:path";

const SERVER_VERSION = "2.7";
const JAR_URL = `https://github.com/Genymobile/scrcpy/releases/download/v${SERVER_VERSION}/scrcpy-server-v${SERVER_VERSION}`;
const CACHE_DIR = join(homedir(), ".cache", "scrcpy-web");
const JAR_PATH = join(CACHE_DIR, `scrcpy-server-v${SERVER_VERSION}.jar`);

export { SERVER_VERSION };

/**
 * Returns a local path to the scrcpy-server jar, downloading it if necessary.
 */
export async function getServerJarPath(): Promise<string> {
  try {
    await access(JAR_PATH);
    return JAR_PATH;
  } catch {
    await mkdir(CACHE_DIR, { recursive: true });
    console.log(
      `[ServerJar] Downloading scrcpy-server v${SERVER_VERSION} from GitHub…`,
    );
    await downloadWithRedirects(JAR_URL, JAR_PATH);
    console.log(`[ServerJar] Saved to ${JAR_PATH}`);
    return JAR_PATH;
  }
}

function downloadWithRedirects(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const follow = (u: string, depth = 0) => {
      if (depth > 5) {
        reject(new Error("Too many redirects"));
        return;
      }
      https
        .get(u, (res) => {
          if (res.statusCode === 301 || res.statusCode === 302) {
            res.resume();
            follow(res.headers.location!, depth + 1);
            return;
          }
          if (res.statusCode !== 200) {
            res.resume();
            reject(new Error(`HTTP ${res.statusCode} fetching ${u}`));
            return;
          }
          const ws = createWriteStream(dest);
          res.pipe(ws);
          ws.on("finish", resolve);
          ws.on("error", (err) => {
            unlink(dest).catch(() => {});
            reject(err);
          });
        })
        .on("error", reject);
    };
    follow(url);
  });
}
