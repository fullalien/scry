import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ScrcpyManager } from '../core/scrcpy/scrcpy-manager.js';
import { logger } from '../core/logger/logger.js';
import { registerHealthHandler } from './handlers/health-handler.js';
import { registerDeviceHandlers } from './handlers/device-handler.js';
import { registerScrcpyHandlers } from './handlers/scrcpy-handler.js';

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

  registerHealthHandler(app);
  registerDeviceHandlers(app);
  registerScrcpyHandlers(app, scrcpyManager, options);

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

  app.get('/mirror/*', async (_request, reply) => {
    const indexHtml = path.join(webDir, 'pages', 'mirror', 'index.html');
    return reply.type('text/html').send(fs.readFileSync(indexHtml, 'utf8'));
  });

  app.get('/*', async (_request, reply) => {
    const indexHtml = path.join(webDir, 'pages', 'home', 'index.html');
    return reply.type('text/html').send(fs.readFileSync(indexHtml, 'utf8'));
  });
}
