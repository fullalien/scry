import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import { ScrcpyManager } from '../core/scrcpy/scrcpy-manager.js';
import {
  DEVICES_PATH,
  HOST_DISPLAY_PATH,
  SCRCPY_PATH,
  SCRCPY_STOP_PATH,
  SCRCPY_STREAM_PATH,
  SCRCPY_DEVICE_STREAM_PATH,
  SCRCPY_DEVICE_CONTROL_PATH,
} from '../shared/constants/path.server.js';
import { listDevices } from './handlers/device-handler.js';
import { getHostDisplayInfo } from './handlers/host-display-handler.js';
import { registerViteFastify } from './vite-fastify.js';
import {
  listSessions,
  startSession,
  stopSession,
  scrcpyStream,
  scrcpyDeviceStream,
  scrcpyDeviceControl,
} from './handlers/scrcpy-handler.js';

export type ServerOptions = {
  scrcpyVideoBitRate: number;
  scrcpyMaxSize: number;
  scrcpyMaxFps: number;
};

export async function createServer(options: ServerOptions) {
  const scrcpyManager = ScrcpyManager.instance;

  const app = Fastify({ logger: false });

  await app.register(fastifyWebsocket);
  await registerViteFastify(app);

  registerDeviceRoutes(app);
  registerScrcpyRoutes(app, scrcpyManager, options);

  app.addHook('onClose', () => {
    scrcpyManager.stopAll();
  });

  return app;
}

function registerDeviceRoutes(app: FastifyInstance) {
  app.get(DEVICES_PATH, listDevices);
  app.get(HOST_DISPLAY_PATH, getHostDisplayInfo);
}

function registerScrcpyRoutes(
  app: FastifyInstance,
  scrcpyManager: ScrcpyManager,
  options: ServerOptions
) {
  app.get(SCRCPY_PATH, listSessions(scrcpyManager));
  app.post(SCRCPY_PATH, startSession(scrcpyManager, options));
  app.post(SCRCPY_STOP_PATH, stopSession(scrcpyManager));
  app.get(SCRCPY_STREAM_PATH, { websocket: true }, scrcpyStream(scrcpyManager));
  app.get(
    SCRCPY_DEVICE_STREAM_PATH,
    { websocket: true },
    scrcpyDeviceStream(scrcpyManager, options)
  );
  app.get(
    SCRCPY_DEVICE_CONTROL_PATH,
    { websocket: true },
    scrcpyDeviceControl(scrcpyManager)
  );
}
