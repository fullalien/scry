import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteFastify } from '@fastify/vite/plugin';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootProjectPath = path.dirname(fileURLToPath(import.meta.url));
const pagesDir = path.resolve(rootProjectPath, 'web', 'pages');

export default defineConfig({
  root: 'web',
  plugins: [viteFastify({ spa: true }), react(), tailwindcss()],
  resolve: {
    alias: {
      '@shared/scrcpy': path.resolve(rootProjectPath, 'src', 'shared', 'scrcpy'),
      '@shared/constants': path.resolve(rootProjectPath, 'src', 'shared', 'constants', 'index.ts'),
      '@shared/codec': path.resolve(rootProjectPath, 'src', 'shared', 'codec', 'index.ts'),
    },
  },
  build: {
    target: 'esnext',
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        home: path.resolve(pagesDir, 'home', 'index.html'),
        device: path.resolve(pagesDir, 'device', 'index.html'),
      },
    },
  },
  environments: {
    client: {
      build: {
        outDir: '../dist/web',
      },
    },
  },
});
