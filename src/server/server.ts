import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ScrcpyManager } from '../core/scrcpy/scrcpy-manager.js';
import { logger } from '../core/logger/logger.js';
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

  // Cache HTML files to avoid repeated reads and potential resource leaks
  const deviceHtml = fs.readFileSync(path.join(webDir, 'pages', 'device', 'index.html'), 'utf8');
  const homeHtml = fs.readFileSync(path.join(webDir, 'pages', 'home', 'index.html'), 'utf8');

  app.get('/device/*', async (_request, reply) => {
    return reply.type('text/html').send(deviceHtml);
  });

  app.get('/*', async (_request, reply) => {
    return reply.type('text/html').send(homeHtml);
  });
}
