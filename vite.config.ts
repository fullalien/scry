import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteFastify } from '@fastify/vite/plugin';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(__dirname, 'web', 'pages', 'home');

export default defineConfig({
  root: srcDir,
  plugins: [viteFastify({ spa: true }), react(), tailwindcss()],
  build: {
    target: 'esnext',
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
  environments: {
    client: {
      build: {
        outDir: path.resolve(__dirname, 'dist', 'web'),
      },
    },
  }
});
