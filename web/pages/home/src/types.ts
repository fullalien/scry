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
  screenCornerRadius?: number;
};

export type ScrcpySession = {
  id: string;
  deviceSerial: string;
  pid: number;
  status: 'running' | 'stopped' | 'error';
  createdAt: number;
  error?: string;
  activeChannelCount: number;
  stats?: {
    packets: number;
    sessionMeta: number;
    configs: number;
    keyframes: number;
    lastHeader?: string;
    lastNalType?: number;
  };
};

export type AppData = {
  devices: AdbDevice[];
  scrcpySessions: ScrcpySession[];
  devicesOk: boolean;
};
