import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteFastify } from '@fastify/vite/plugin';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pagesDir = path.resolve(__dirname, 'web', 'pages');

export default defineConfig({
  root: 'web',
  plugins: [viteFastify({ spa: true }), react(), tailwindcss()],
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
