import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteFastify } from '@fastify/vite/plugin';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

export default defineConfig({
  root: __dirname,
  plugins: [viteFastify({ spa: true }), react(), tailwindcss()],
  build: {
    outDir: path.join(projectRoot, 'dist', 'web'),
    emptyOutDir: true,
  },
});
