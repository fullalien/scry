import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ScrcpyManager } from '../core/scrcpy/scrcpy-manager.js';
import { logger } from '../core/logger/logger.js';
import {
  DEVICES_PATH,
  SCRCPY_PATH,
  SCRCPY_STOP_PATH,
  SCRCPY_STREAM_PATH,
  SCRCPY_DEVICE_STREAM_PATH,
} from '../shared/constants/path.server.js';
import { listDevices } from './handlers/device-handler.js';
import {
  listSessions,
  startSession,
  stopSession,
  scrcpyStream,
  scrcpyDeviceStream,
} from './handlers/scrcpy-handler.js';

export type ServerOptions = {
  scrcpyVideoBitRate?: number;
  scrcpyMaxSize?: number;
  scrcpyMaxFps?: number;
};

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../'
);

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

async function registerViteFastify(app: FastifyInstance): Promise<void> {
  const webDir = path.join(projectRoot, 'dist', 'web');
  if (!fs.existsSync(webDir)) {
    logger.warn('Web directory not found, skipping static file serving');
    return;
  }
  await app.register(fastifyStatic, {
    root: path.join(webDir, 'assets'),
    prefix: '/assets/',
    decorateReply: false,
  });

  const deviceHtml = fs.readFileSync(
    path.join(webDir, 'pages', 'device', 'index.html'),
    'utf8'
  );
  const homeHtml = fs.readFileSync(
    path.join(webDir, 'pages', 'home', 'index.html'),
    'utf8'
  );

  app.get('/device/*', async (_request, reply) => {
    return reply.type('text/html').send(deviceHtml);
  });

  app.get('/*', async (_request, reply) => {
    return reply.type('text/html').send(homeHtml);
  });
}

function registerDeviceRoutes(app: FastifyInstance) {
  app.get(DEVICES_PATH, listDevices);
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
}
