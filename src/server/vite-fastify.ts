import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getHostDisplays } from '../core/display/host-display.js';
import { logger } from '../core/logger/logger.js';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../'
);

export async function registerViteFastify(app: FastifyInstance): Promise<void> {
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

  const deviceHtmlPath = path.join(webDir, 'pages', 'device', 'index.html');
  const homeHtmlPath = path.join(webDir, 'pages', 'home', 'index.html');

  const isDev = process.env['NODE_ENV'] !== 'production';
  const cachedDeviceHtml = isDev
    ? null
    : fs.readFileSync(deviceHtmlPath, 'utf8');
  const cachedHomeHtml = isDev ? null : fs.readFileSync(homeHtmlPath, 'utf8');

  app.get('/device/*', async (_request, reply) => {
    const html = isDev
      ? fs.readFileSync(deviceHtmlPath, 'utf8')
      : cachedDeviceHtml!;
    return reply.type('text/html').send(await injectHostDisplays(html));
  });

  app.get('/*', async (_request, reply) => {
    const html = isDev
      ? fs.readFileSync(homeHtmlPath, 'utf8')
      : cachedHomeHtml!;
    return reply.type('text/html').send(html);
  });
}

async function injectHostDisplays(html: string): Promise<string> {
  const displays = await getHostDisplays();
  const json = JSON.stringify(displays).replaceAll('<', '\\u003c');
  const script = `<script>window.__SCRY_HOST_DISPLAYS__=${json};</script>`;
  return html.includes('</head>')
    ? html.replace('</head>', `${script}</head>`)
    : `${script}${html}`;
}
