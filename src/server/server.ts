import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyVite from '@fastify/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  startAutoCleanup as startSessionAutoCleanup,
  stopAutoCleanup as stopSessionAutoCleanup,
} from '../core/sessions/session-manager.js';
import { ScrcpyManager } from '../core/scrcpy/scrcpy-manager.js';
import { initLogger, type LoggerOptions } from '../core/logger/logger.js';
import { registerHealthHandler } from './handlers/health-handler.js';
import { registerSessionHandlers } from './handlers/session-handler.js';
import { registerDeviceHandlers } from './handlers/device-handler.js';
import { registerScrcpyHandlers } from './handlers/scrcpy-handler.js';

export type CreateWebServerOptions = {
  scrcpyVideoBitRate?: number;
  scrcpyMaxSize?: number;
  scrcpyMaxFps?: number;
  logger?: LoggerOptions;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../');
const webRoot = path.join(projectRoot, 'web', 'pages', 'home');

export async function createWebServer(options: CreateWebServerOptions) {
  if (options.logger) {
    initLogger(options.logger);
  }

  const app = Fastify({ logger: false });

  const scrcpyManager = new ScrcpyManager();

  scrcpyManager.startAutoCleanup();
  startSessionAutoCleanup();

  await app.register(fastifyWebsocket);

  await app.register(fastifyVite, {
    root: webRoot,
    dev: false,
    spa: true,
  });

  await app.vite.ready();

  registerHealthHandler(app);
  registerSessionHandlers(app);
  registerDeviceHandlers(app);
  registerScrcpyHandlers(app, scrcpyManager, options);

  app.get('/*', async (_request, reply) => {
    return reply.html();
  });

  app.addHook('onClose', () => {
    scrcpyManager.stopAll();
    scrcpyManager.stopAutoCleanup();
    stopSessionAutoCleanup();
  });

  return app;
}
