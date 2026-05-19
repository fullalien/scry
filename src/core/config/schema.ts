import { z } from 'zod';
import { DEFAULT_HOST, DEFAULT_PORT } from './config.constants.js';

export const ConfigSchema = z.object({
  server: z
    .object({
      host: z.string().default(DEFAULT_HOST),
      port: z.number().int().min(1).max(65535).default(DEFAULT_PORT),
    })
    .default({ host: DEFAULT_HOST, port: DEFAULT_PORT }),
  adb: z
    .object({
      path: z.string().default('adb'),
    })
    .default({ path: 'adb' }),
  scrcpy: z
    .object({
      /** Maximum dimension (width or height) in pixels. 0 = no limit (default). */
      maxSize: z.number().int().min(0).default(0),
      /** Video bit rate in bps (e.g. 4000000 = 4 Mbps). scrcpy v4+ requires a plain integer. */
      videoBitRate: z.number().int().positive().default(4_000_000),
      maxFps: z.number().int().positive().default(60),
    })
    .default({ maxSize: 0, videoBitRate: 4_000_000, maxFps: 60 }),
});

export type AppConfig = z.infer<typeof ConfigSchema>;
