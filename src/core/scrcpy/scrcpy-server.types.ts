export type ScrcpyServerOptions = {
  deviceSerial: string;
  maxSize?: number;
  maxFps?: number;
  control?: boolean;
  audio?: boolean;
  scid?: number;
  /** Bit rate in bps, or a suffixed string: "8M" = 8_000_000, "4000K" = 4_000_000. */
  videoBitRate?: number | string;
};

export type ScrcpyServerStats = {
  packets: number;
  sessionMeta: number;
  configs: number;
  keyframes: number;
  deviceMessages: number;
  lastHeader?: string;
  lastNalType?: number;
};
